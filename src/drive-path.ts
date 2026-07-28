import { DRIVE_PREFIX } from "./drive-operations.ts";
import { physicalObjectKeyFits } from "./storage-key.ts";

export function isValidDrivePath(
  path: string,
  options: {
    readonly allowEmpty?: boolean;
    readonly allowFolder?: boolean;
  } = {},
): boolean {
  if (path === "") return options.allowEmpty === true;
  const allowFolder = options.allowFolder ?? true;
  if (
    !physicalObjectKeyFits(DRIVE_PREFIX, path) ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    (!allowFolder && path.endsWith("/"))
  ) {
    return false;
  }
  const segments = path.split("/");
  if (allowFolder && segments.at(-1) === "") segments.pop();
  return (
    segments.length > 0 &&
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    )
  );
}
