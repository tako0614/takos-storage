/** Bun.build inlines text-imported assets; tsc needs the matching declaration. */
declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "*.webmanifest" {
  const content: string;
  export default content;
}
