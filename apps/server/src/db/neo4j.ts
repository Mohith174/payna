import neo4j, { type Driver } from "neo4j-driver";
import { config } from "../config.js";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      config.NEO4J_URI,
      neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD),
      // Our integers (graceDays, intervalMonths) are all well within JS safe-integer
      // range, so plain numbers over Neo4j's Integer wrapper keep call sites simple.
      { disableLosslessIntegers: true },
    );
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
