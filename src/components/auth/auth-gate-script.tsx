import Script from "next/script";

/**
 * Runs before React hydrates. Unauthenticated users are sent to /login even if
 * client JS fails to boot (which previously left the UI stuck on a spinner).
 */
export function AuthGateScript() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
  const code = `(function () {
  var path = location.pathname || "/";
  if (path === "/login" || path === "/register") return;
  var base = ${JSON.stringify(apiBase)} || (location.origin + "/api");
  base = String(base).replace(/\\/$/, "");
  var done = false;
  function goLogin() {
    if (done) return;
    done = true;
    location.replace("/login");
  }
  var timer = setTimeout(goLogin, 4000);
  fetch(base + "/auth/me", { credentials: "include" })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) goLogin();
      else done = true;
    })
    .catch(function () {
      clearTimeout(timer);
      goLogin();
    });
})();`;

  return (
    <Script id="watchpot-auth-gate" strategy="beforeInteractive">
      {code}
    </Script>
  );
}
