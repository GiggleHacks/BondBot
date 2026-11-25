// Local addition (BondBot): six masked digits that sound like a dial-up phone as they are typed.
import { PIN_LENGTH } from "@rakazo/core";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@rakazo/ui-web";
import { useRef } from "react";
import { playDialTone, playModemHandshake } from "../../lib/fx/dial-tones";

export function PinInput({
  value,
  onChange,
  onComplete,
  label,
  autoFocus = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (pin: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const previous = useRef(value);
  return (
    <InputOTP
      aria-label={label}
      maxLength={PIN_LENGTH}
      pattern={"^\\d+$"}
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(next: string) => {
        // Each new digit plays its touch-tone, one after another when several arrive at once
        // (a paste); deleting stays quiet.
        if (next.length > previous.current.length) {
          const added = [...next.slice(previous.current.length)];
          for (const [i, digit] of added.entries()) playDialTone(digit, i * 0.14);
        }
        previous.current = next;
        onChange(next);
      }}
      onComplete={(pin: string) => {
        playModemHandshake();
        onComplete?.(pin);
      }}
    >
      <InputOTPGroup>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <InputOTPSlot
            key={index}
            index={index}
            masked
            className="size-12 text-heading3 first:rounded-l-xl last:rounded-r-xl"
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
