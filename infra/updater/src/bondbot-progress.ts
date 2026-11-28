/**
 * Reads the live output of `git fetch --progress` and `docker build --progress=plain`, so the
 * app can show how far an update is, how fast it downloads and that it is still working.
 */
export interface StepProgress {
  /** 0 to 1 within the current command. */
  fraction: number;
  detail: string | null;
  downloadedBytes?: number;
  bytesPerSecond?: number;
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
};

function toBytes(value: string, unit: string): number {
  return Math.round(Number(value) * (UNITS[unit.toLowerCase()] ?? 0));
}

/** Splits a stream on newlines and the carriage returns progress meters redraw with. */
function lineSplitter(onLine: (line: string) => void) {
  let rest = "";
  return (chunk: string) => {
    const parts = `${rest}${chunk}`.split(/[\r\n]/);
    rest = parts.pop() ?? "";
    for (const part of parts) if (part.trim()) onLine(part.trim());
  };
}

const GIT_RECEIVING =
  /^Receiving objects:\s+(\d+)%(?:[^,]*, ([\d.]+) (bytes|KiB|MiB|GiB)(?: \| ([\d.]+) (bytes|KiB|MiB|GiB)\/s)?)?/;
const GIT_RESOLVING = /^Resolving deltas:\s+(\d+)%/;

export function gitProgressReader(report: (progress: StepProgress) => void) {
  return lineSplitter((line) => {
    const receiving = GIT_RECEIVING.exec(line);
    if (receiving) {
      const [, percent, size, sizeUnit, speed, speedUnit] = receiving;
      const unit = (raw: string) => (raw === "bytes" ? "b" : raw);
      report({
        fraction: (Number(percent) / 100) * 0.9,
        detail: "Receiving files",
        ...(size && sizeUnit ? { downloadedBytes: toBytes(size, unit(sizeUnit)) } : {}),
        ...(speed && speedUnit ? { bytesPerSecond: toBytes(speed, unit(speedUnit)) } : {}),
      });
      return;
    }
    const resolving = GIT_RESOLVING.exec(line);
    if (resolving) {
      report({ fraction: 0.9 + Number(resolving[1]) / 1000, detail: "Unpacking files" });
    }
  });
}

const VERTEX_STEP = /^#(\d+) \[(?:([^\]]*?)\s+)?(\d+)\/(\d+)\] (.*)$/;
const VERTEX_END = /^#(\d+) (?:DONE|CACHED)\b/;
const LAYER = /^#\d+ (sha256:[0-9a-f]+) ([\d.]+)([kMG]?B) \/ [\d.]+[kMG]?B/;
const OUTPUT = /^#(\d+) [\d.]+ (.+)$/;

export function buildProgressReader(
  report: (progress: StepProgress) => void,
  now: () => number = Date.now,
) {
  const stageTotals = new Map<string, number>();
  const steps = new Map<string, string>();
  const done = new Set<string>();
  const layers = new Map<string, number>();
  let sample: { at: number; bytes: number } | null = null;
  let speed: number | undefined;
  let step: string | null = null;
  let fraction = 0;

  function emit(detail: string | null) {
    const total = [...stageTotals.values()].reduce((sum, count) => sum + count, 0);
    // Later stages appear as the build goes, so the share never moves backwards.
    if (total > 0) fraction = Math.max(fraction, Math.min(1, done.size / total));
    const bytes = [...layers.values()].reduce((sum, value) => sum + value, 0);
    report({
      fraction,
      detail,
      ...(bytes > 0 ? { downloadedBytes: bytes } : {}),
      ...(speed !== undefined ? { bytesPerSecond: speed } : {}),
    });
  }

  return lineSplitter((line) => {
    const vertex = VERTEX_STEP.exec(line);
    if (vertex) {
      const [, id, stage = "build", index, count, command] = vertex;
      stageTotals.set(stage, Number(count));
      step = `${stage} ${index}/${count}: ${command}`;
      steps.set(id!, step);
      speed = undefined;
      emit(step);
      return;
    }
    const end = VERTEX_END.exec(line);
    if (end) {
      if (steps.has(end[1]!)) done.add(end[1]!);
      speed = undefined;
      emit(step);
      return;
    }
    const layer = LAYER.exec(line);
    if (layer) {
      layers.set(layer[1]!, toBytes(layer[2]!, layer[3]!));
      const bytes = [...layers.values()].reduce((sum, value) => sum + value, 0);
      const at = now();
      if (!sample) sample = { at, bytes };
      else if (at - sample.at >= 500) {
        speed = Math.max(0, Math.round(((bytes - sample.bytes) * 1000) / (at - sample.at)));
        sample = { at, bytes };
      }
      emit(step ?? "Downloading base images");
      return;
    }
    const output = OUTPUT.exec(line);
    if (output) emit(output[2]!);
  });
}
