import { restoreSetup } from "./db";

export default async function globalTeardown() {
  await restoreSetup();
}
