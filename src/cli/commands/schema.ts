import { configJsonSchema } from "../../config/schema.ts";
import { print } from "../output.ts";

export function printSchema() {
  print(JSON.stringify(configJsonSchema(), null, 2));
}
