// Random "hacker" readout lines for the landing backdrop: hex dumps, assembly, C-ish code, logs.

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const hex = (digits: number) =>
  Array.from({ length: digits }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const byte = () => hex(2);
const ip = () =>
  `${10 + Math.floor(Math.random() * 180)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}`;
const bits = () =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 8 }, () => (Math.random() < 0.5 ? "0" : "1")).join(""),
  ).join(" ");

const NAMES = ["ctx", "buf", "key", "sig", "frame", "node", "port", "seed", "mask", "core"];
const CALLS = ["inject", "decrypt", "handshake", "spawn", "bind", "scan", "hash", "patch", "sync"];
const REGS = ["eax", "ebx", "ecx", "edx", "rsi", "rdi", "r8", "r12"];
const OPS = ["mov", "xor", "add", "cmp", "jmp", "push", "pop", "lea", "call"];
const STATUS = ["OK", "OK", "OK", "WAIT", "SYNC", "ACK"];

const TEMPLATES: readonly (() => string)[] = [
  () =>
    `0x${hex(8)}  ${Array.from({ length: 8 }, byte).join(" ")}  ${Array.from({ length: 8 }, byte).join(" ")}`,
  () => `${pick(OPS)} ${pick(REGS)}, [${pick(REGS)}+0x${hex(2)}]`,
  () =>
    `for (i = 0; i < ${16 << Math.floor(Math.random() * 4)}; i++) ${pick(NAMES)}[i] ^= key[i % 32];`,
  () =>
    `if (${pick(NAMES)} == 0x${hex(4).toUpperCase()}) ${pick(CALLS)}(&${pick(NAMES)}, ${Math.floor(Math.random() * 4096)});`,
  () => `[${pick(STATUS)}] ${pick(CALLS)} ${ip()}:${pick([22, 443, 8080, 1337, 31337])}`,
  () => `sha256 ${hex(40)}`,
  () => bits(),
  () => `${pick(NAMES)}->${pick(NAMES)} = ${pick(CALLS)}(${pick(NAMES)}, 0x${hex(6)});`,
  () =>
    `PID ${1000 + Math.floor(Math.random() * 60000)}  ${pick(CALLS)}d  ${(Math.random() * 99).toFixed(1)}%  ${hex(4)}`,
  () => `while (!${pick(NAMES)}_ready) { ${pick(CALLS)}(${pick(NAMES)}); }`,
  () => `> ${pick(CALLS)} --target ${ip()} --mode ${pick(["stealth", "deep", "raw", "fast"])}`,
];

/** One random line of readout text. */
export function codeLine(): string {
  return pick(TEMPLATES)();
}
