import { snapshotAndWipe } from "./db";

export default async function globalSetup() {
  await snapshotAndWipe();
}
