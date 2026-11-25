import * as ImagePicker from "expo-image-picker";
import { loadImageManipulator } from "../composer/pick-attachments";

/** Uploaded photos are drawn at most 48pt wide, so 192px stays sharp on 3x screens. */
const PHOTO_SIZE = 192;

/**
 * Lets the person pick and square-crop a photo, then shrinks it to a small JPEG data URL for the
 * account. Null when they cancel or the device cannot resize images.
 */
export async function pickAccountPhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const manipulator = loadImageManipulator();
  if (!manipulator) return null;
  const context = manipulator.ImageManipulator.manipulate(asset.uri);
  context.resize({ width: PHOTO_SIZE, height: PHOTO_SIZE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    base64: true,
    compress: 0.85,
    format: manipulator.SaveFormat.JPEG,
  });
  return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : null;
}
