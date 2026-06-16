import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "./src/server/routes/instance/httpapi/public"

try {
  const spec = OpenApi.fromApi(PublicApi)
  console.log("OpenAPI spec generated successfully")
  console.log("Path count:", Object.keys(spec.paths || {}).length)
} catch (e: any) {
  console.error("OpenAPI generation FAILED:", e?.message ?? String(e))
}
