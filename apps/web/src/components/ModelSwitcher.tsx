// Local addition (David, 2026-11-21): tap the model icon in the chat header, pick a model from a
// dropdown. The pixel animation plays only after the server has saved the switch.

import type { ConnectedModelChoice } from "@rakazo/core";
import { connectedModelChoices, modelOptionKey } from "@rakazo/core";
import { Button, Popover, PopoverContent, PopoverTrigger, toast } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Check, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { shortModelLabel } from "../lib/model-label";
import { useSave, useSpaceQueries } from "../lib/query/query";
import { ModelBrandIcon, modelBrandInfo, modelBrandKey } from "./ModelBrandIcon";
import { modelGlowColorFor } from "./ModelEdgeGlow";
import type { IconSpec } from "./ModelSwitchFx";
import { playModelSwitchFx } from "./ModelSwitchFx";

export type SwitchResult = { provider: string; modelId: string } | undefined;

function iconSpecFor(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): IconSpec | null {
  const info = modelBrandInfo(modelBrandKey(provider, modelId));
  if (!info) return null;
  return {
    url: `/model-icons/${info.file}`,
    mono: info.mono,
    tint: info.color ?? "#f4f4f5",
  };
}

function PixelDots() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((value) => (value + 1) % 3), 140);
    return () => clearInterval(timer);
  }, []);
  return (
    <span aria-hidden="true" className="flex items-end gap-[3px]" data-testid="model-row-pending">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block size-[5px] bg-current"
          style={{ transform: `translateY(${step === i ? -4 : 0}px)` }}
        />
      ))}
    </span>
  );
}

function PixelCross() {
  const cells: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 1],
    [2, 2],
    [2, 0],
    [0, 2],
  ];
  return (
    <span
      aria-hidden="true"
      className="relative block size-[15px] text-red-400"
      data-testid="model-row-error"
    >
      {cells.map(([x, y]) => (
        <span
          key={`${x}${y}`}
          className="absolute block size-[5px] bg-current"
          style={{ left: x * 5, top: y * 5 }}
        />
      ))}
    </span>
  );
}

/** Pins a model to the top of the list, beside its row so a tap here never switches the model. */
function StarButton({ choice, starred }: { choice: ConnectedModelChoice; starred: boolean }) {
  const queries = useSpaceQueries();
  const save = useSave({
    save: (next: boolean, client) =>
      client.botModels.setStarred({
        provider: choice.provider,
        modelId: choice.modelId,
        starred: next,
      }),
    stale: [queries.botModels.starred.key()],
    onFailed: () => toast.error("Could not save the star."),
  });
  const on = save.pending ? Boolean(save.input) : starred;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-testid="model-star"
      aria-label={`Star ${shortModelLabel(choice.modelId)}`}
      aria-pressed={on}
      disabled={save.pending}
      onClick={() => save.run(!starred)}
      className="me-1 shrink-0 text-muted-foreground aria-pressed:text-foreground"
    >
      <Star size={15} strokeWidth={2} className={on ? "fill-current" : undefined} />
    </Button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

export function ModelSwitcherView({
  bot,
  choices,
  mostUsed,
  starred,
  onSwitch,
}: {
  bot: { id: string; name: string; modelProvider: string | null; modelId: string | null };
  choices: readonly ConnectedModelChoice[];
  /** Models by use, most used first. */
  mostUsed: readonly { provider: string; modelId: string }[];
  /** Models pinned to the top, oldest first. */
  starred: readonly { provider: string; modelId: string }[];
  /** Resolves only once the switch is saved; rejects if it was not. */
  onSwitch: (choice: { provider: string; modelId: string }) => Promise<SwitchResult>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const errorTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(errorTimerRef.current), []);
  const currentKey =
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "";

  const { pinned, top, rest } = useMemo(() => {
    const byKey = new Map(choices.map((choice) => [choice.key, choice]));
    // A starred model that is not connected now has no row, and keeps its star for later.
    const connected = (models: readonly { provider: string; modelId: string }[]) =>
      models.flatMap((model) => byKey.get(modelOptionKey(model.provider, model.modelId)) ?? []);
    const pinnedChoices = [...new Set(connected(starred))];
    const topChoices = [...new Set(connected(mostUsed))]
      .filter((choice) => !pinnedChoices.includes(choice))
      .slice(0, 3);
    return {
      pinned: pinnedChoices,
      top: topChoices,
      rest: choices.filter(
        (choice) => !pinnedChoices.includes(choice) && !topChoices.includes(choice),
      ),
    };
  }, [choices, mostUsed, starred]);

  async function choose(choice: ConnectedModelChoice) {
    if (pendingKey) return;
    if (choice.key === currentKey) {
      setOpen(false);
      return;
    }
    setPendingKey(choice.key);
    setErrorKey(null);
    let result: SwitchResult;
    try {
      result = await onSwitch({ provider: choice.provider, modelId: choice.modelId });
    } catch {
      setPendingKey(null);
      setErrorKey(choice.key);
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = window.setTimeout(
        () => setErrorKey((key) => (key === choice.key ? null : key)),
        2500,
      );
      return;
    }
    // The server has saved it: only now does anything celebrate.
    const to = result ?? { provider: choice.provider, modelId: choice.modelId };
    setPendingKey(null);
    setOpen(false);
    const chip = chipRef.current;
    if (!chip) return;
    const style = window.getComputedStyle(chip);
    void playModelSwitchFx({
      chip: chip.getBoundingClientRect(),
      chipBackground: style.backgroundColor,
      from: iconSpecFor(bot.modelProvider, bot.modelId),
      to: iconSpecFor(to.provider, to.modelId),
      color: modelGlowColorFor(to.provider, to.modelId) ?? "#d4d4d8",
    });
  }

  const row = (choice: ConnectedModelChoice, isStarred = false) => {
    const current = choice.key === currentKey;
    const state =
      pendingKey === choice.key
        ? "pending"
        : errorKey === choice.key
          ? "error"
          : pendingKey
            ? "dim"
            : "idle";
    return (
      <div
        key={choice.key}
        className={`flex items-center rounded-xl ${
          current || state === "pending" ? "bg-foreground/10" : "hover:bg-foreground/5"
        }`}
      >
        <button
          type="button"
          data-testid="model-row"
          data-key={choice.key}
          data-current={current ? "" : undefined}
          data-state={state}
          disabled={Boolean(pendingKey) && pendingKey !== choice.key}
          onClick={() => void choose(choice)}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-start text-body font-medium text-foreground transition-opacity ${
            state === "dim" ? "opacity-40" : ""
          }`}
        >
          <ModelBrandIcon
            modelProvider={choice.provider}
            modelId={choice.modelId}
            className="size-[18px]"
          />
          <span className="min-w-0 flex-1 truncate">{shortModelLabel(choice.modelId)}</span>
          <span className="text-[11px] font-normal text-muted-foreground">High</span>
          <span className="grid w-4 place-items-center">
            {state === "pending" ? (
              <PixelDots />
            ) : state === "error" ? (
              <PixelCross />
            ) : current ? (
              <Check size={15} strokeWidth={2.2} className="text-emerald-400" />
            ) : null}
          </span>
        </button>
        <StarButton choice={choice} starred={isStarred} />
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={(next) => (pendingKey ? undefined : setOpen(next))}>
      <PopoverTrigger
        render={
          <Button
            ref={chipRef}
            variant="floating"
            size="icon-sm"
            data-testid="header-model-chip"
            aria-label={`Model: ${bot.modelId ?? ""}. Tap to switch.`}
            className="app-no-drag size-[34px] shrink-0 rounded-full p-0"
          />
        }
      >
        <ModelBrandIcon
          modelProvider={bot.modelProvider}
          modelId={bot.modelId}
          className="size-[18px]"
        />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        data-testid="model-dropdown"
        className="app-no-drag w-[min(310px,calc(100vw-24px))] gap-0 p-2"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {pinned.length > 0 ? (
            <div data-testid="model-starred-list">
              <SectionLabel>Starred</SectionLabel>
              {pinned.map((choice) => row(choice, true))}
            </div>
          ) : null}
          {top.length > 0 ? (
            <div data-testid="model-top-list">
              <SectionLabel>Most used</SectionLabel>
              {top.map((choice) => row(choice))}
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div data-testid="model-all-list">
              <SectionLabel>
                {pinned.length + top.length > 0 ? "All models" : "Models"}
              </SectionLabel>
              {rest.map((choice) => row(choice))}
            </div>
          ) : null}
        </div>
        {errorKey ? (
          <div role="alert" className="px-3 pt-2 text-body-sm text-red-400">
            Didn't switch. The old model is kept. Tap to retry.
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The header's model chip with its dropdown, fed by the connected models, stars and recent use. */
export function ModelSwitcher({
  bot,
  onSwitch,
}: {
  bot: { id: string; name: string; modelProvider: string | null; modelId: string | null };
  onSwitch: (choice: { provider: string; modelId: string }) => Promise<SwitchResult>;
}) {
  const queries = useSpaceQueries();
  const credentials = useQuery(queries.models.credentials.queryOptions()).data;
  const catalog = useQuery(queries.models.list.queryOptions()).data;
  const usage = useQuery({ ...queries.botModels.mostUsed.queryOptions(), staleTime: 60_000 }).data;
  const starred = useQuery(queries.botModels.starred.queryOptions()).data;
  const choices = useMemo(
    () => connectedModelChoices(credentials ?? [], catalog ?? []),
    [credentials, catalog],
  );
  return (
    <ModelSwitcherView
      bot={bot}
      choices={choices}
      mostUsed={usage ?? []}
      starred={starred ?? []}
      onSwitch={onSwitch}
    />
  );
}
