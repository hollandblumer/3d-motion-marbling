const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; frame-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self' blob:; manifest-src 'self';",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const securedResponse = new Response(response.body, response);

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      securedResponse.headers.set(name, value);
    }

    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/_next/static/")) {
      securedResponse.headers.set(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
    } else if (pathname.endsWith("/mano-landmark-regressor.onnx")) {
      securedResponse.headers.set("Cache-Control", "public, max-age=604800");
    }

    return securedResponse;
  },
};
