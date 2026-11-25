import { bestEffort } from "@rakazo/logging/best-effort";
import { Button } from "@rakazo/ui-web";
import { Camera, UserRound } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { authClient } from "../../lib/auth/auth";
import { squareImageDataUrl } from "../../lib/images/square-image";
import { useSave } from "../../lib/query/query";
import { authErrorText } from "../../lib/query/user-error";

/** Uploaded photos are drawn at most 48px wide, so 192px stays sharp on 4x screens. */
const PHOTO_SIZE = 192;

/**
 * The account photo in Settings: click or drop an image to replace it. The photo is cropped
 * square in the browser and saved on the account, so every device shows it.
 */
export function AccountPhoto({
  image,
  initials,
  onSaved,
}: {
  image?: string | null;
  initials: string | null;
  onSaved?: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const photoSave = useSave({
    save: async (next: string | null) => {
      const result = await authClient.updateUser({ image: next }).catch(() => {
        throw new Error("Could not update photo");
      });
      if (result.error) throw new Error(authErrorText(result.error, "Could not update photo"));
      // The sidebar shows the photo too, so it refreshes even after Settings closes.
      if (onSaved) void bestEffort("refresh session after a photo change", onSaved());
    },
  });

  async function uploadFile(file: File | undefined) {
    if (!file || photoSave.pending) return;
    photoSave.reset();
    const dataUrl = await squareImageDataUrl(file, PHOTO_SIZE);
    if (dataUrl) photoSave.run(dataUrl);
  }

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    void uploadFile(event.dataTransfer.files[0]);
  }

  const showImage = image && failedImage !== image;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={image ? "Change photo" : "Add photo"}
        data-testid="account-photo"
        disabled={photoSave.pending}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`group relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-body font-semibold text-secondary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${dragging ? "ring-2 ring-ring" : ""}`}
      >
        {showImage ? (
          <img
            src={image}
            alt=""
            className="size-full object-cover"
            onError={() => setFailedImage(image)}
          />
        ) : initials ? (
          initials
        ) : (
          <UserRound size={20} aria-hidden="true" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-overlay text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera size={18} aria-hidden="true" />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          void uploadFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {image ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={photoSave.pending}
          onClick={() => photoSave.run(null)}
        >
          Remove photo
        </Button>
      ) : null}
      {photoSave.error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {photoSave.error.message}
        </p>
      ) : null}
    </div>
  );
}
