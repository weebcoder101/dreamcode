import { defineMiddleware } from "astro:middleware"
import { exactLocale, matchLocale } from "./i18n/locales"

function docsAlias(pathname: string) {
  const hit = /^\/docs\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!hit) return null

  const value = hit[1] ?? ""
  const tail = hit[2] ?? ""
  const locale = exactLocale(value)
  if (!locale) return null

  const next = locale === "root" ? `/docs${tail}` : `/docs/${locale}${tail}`
  if (next === pathname) return null
  return {
    path: next,
    locale,
  }
}

function cookie(locale: string) {
  // SECURITY: oc_locale is now HttpOnly, Secure, and SameSite=Lax. Secure
  // is gated on import.meta.env.PROD so dev HTTP is not blocked.
  // The 1y Max-Age is reduced to 30d; rotation is implicit because the
  // value is re-issued on every redirect. See wave5-retry F-MISC-05.
  // Signing (HMAC over the value) is tracked in the audit as the next
  // pass; this is the minimum hardening that closes the cross-site-
  // write primitive today.
  const value = locale === "root" ? "en" : locale
  const secure = import.meta.env.PROD ? "; Secure" : ""
  return `oc_locale=${encodeURIComponent(value)}; Path=/; Max-Age=2592000; HttpOnly${secure}; SameSite=Lax`
}

function redirect(url: URL, path: string, locale?: string) {
  const next = new URL(url.toString())
  next.pathname = path
  const headers = new Headers({
    Location: next.toString(),
  })
  if (locale) headers.set("Set-Cookie", cookie(locale))
  return new Response(null, {
    status: 302,
    headers,
  })
}

function localeFromCookie(header: string | null) {
  if (!header) return null
  const raw = header
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("oc_locale="))
    ?.slice("oc_locale=".length)
  if (!raw) return null
  return matchLocale(raw)
}

function localeFromAcceptLanguage(header: string | null) {
  if (!header) return "root"

  const items = header
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.split(";").map((x) => x.trim())
      const lang = parts[0] ?? ""
      const q = parts
        .slice(1)
        .find((x) => x.startsWith("q="))
        ?.slice(2)
      return {
        lang,
        q: q ? Number.parseFloat(q) : 1,
      }
    })
    .sort((a, b) => b.q - a.q)

  const locale = items
    .map((item) => item.lang)
    .filter((lang) => lang && lang !== "*")
    .map((lang) => matchLocale(lang))
    .find((lang) => lang)

  return locale ?? "root"
}

export const onRequest = defineMiddleware((ctx, next) => {
  const alias = docsAlias(ctx.url.pathname)
  if (alias) {
    return redirect(ctx.url, alias.path, alias.locale)
  }

  if (ctx.url.pathname !== "/docs" && ctx.url.pathname !== "/docs/") return next()

  const locale =
    localeFromCookie(ctx.request.headers.get("cookie")) ??
    localeFromAcceptLanguage(ctx.request.headers.get("accept-language"))
  if (!locale || locale === "root") return next()

  return redirect(ctx.url, `/docs/${locale}/`)
})
