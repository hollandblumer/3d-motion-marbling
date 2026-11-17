const COOKIE_NAME = "marbling_access";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; frame-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self' blob:; manifest-src 'self';",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
};

function secure(response) {
  const securedResponse = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    securedResponse.headers.set(name, value);
  }
  securedResponse.headers.set("Cache-Control", "private, no-store");
  return securedResponse;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function accessToken(password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("3d-motion-marbling-access-v1"),
  );
  return toBase64Url(signature);
}

async function passwordsMatch(candidate, expected) {
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function cookieValue(request) {
  const cookies = request.headers.get("Cookie") || "";
  for (const cookie of cookies.split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return "";
}

function loginPage(error = false) {
  const message = error
    ? '<p class="error" role="alert">That password was not accepted.</p>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>3D Motion Marbling</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3eddb;color:#171717;font:16px/1.4 system-ui,sans-serif}.card{width:min(100%,390px);padding:32px;border:1px solid #b8b09d;border-radius:18px;background:#fffdf7;box-shadow:0 18px 50px #4039271a}h1{margin:0 0 8px;font-size:25px}p{margin:0 0 22px;color:#5c574d}label{display:block;margin-bottom:8px;font-weight:650}input,button{width:100%;height:48px;border-radius:10px;font:inherit}input{border:1px solid #979083;padding:0 14px;background:#fff}input:focus{outline:3px solid #8aa4ff66;border-color:#526dc4}button{margin-top:14px;border:0;background:#171717;color:#fff;font-weight:700;cursor:pointer}.error{margin:12px 0 0;color:#a51d1d;font-size:14px}
  </style>
</head>
<body>
  <main class="card">
    <h1>3D Motion Marbling</h1>
    <p>Enter the shared password to continue.</p>
    <form method="post" action="/__login">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autofocus autocomplete="current-password">
      <button type="submit">Enter</button>
      ${message}
    </form>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    if (!env.SITE_PASSWORD) {
      return secure(new Response("Site password is not configured.", { status: 503 }));
    }

    const url = new URL(request.url);

    if (url.pathname === "/__login" && request.method === "POST") {
      const clientKey = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.LOGIN_RATE_LIMITER.limit({ key: clientKey });
      if (!success) {
        return secure(
          new Response("Too many password attempts. Try again in one minute.", {
            status: 429,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Retry-After": "60",
            },
          }),
        );
      }

      const form = await request.formData();
      const submittedPassword = String(form.get("password") || "");
      if (await passwordsMatch(submittedPassword, env.SITE_PASSWORD)) {
        const token = await accessToken(env.SITE_PASSWORD);
        return secure(
          new Response(null, {
            status: 303,
            headers: {
              Location: "/",
              "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
            },
          }),
        );
      }
      return secure(
        new Response(loginPage(true), {
          status: 401,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    }

    if (url.pathname === "/__logout") {
      return secure(
        new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
          },
        }),
      );
    }

    const expectedToken = await accessToken(env.SITE_PASSWORD);
    if (cookieValue(request) !== expectedToken) {
      return secure(
        new Response(loginPage(), {
          status: 401,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    }

    return secure(await env.ASSETS.fetch(request));
  },
};
