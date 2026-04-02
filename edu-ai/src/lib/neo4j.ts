import neo4j, { Driver } from "neo4j-driver";

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (!_driver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;
    if (!uri || !user || !password) {
      throw new Error("Missing NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars");
    }
    _driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return _driver;
}
