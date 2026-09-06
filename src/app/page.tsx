import { redirect } from "next/navigation";

/** Leave `/` immediately — unauthenticated users are bounced from /dashboard → /login. */
export default function Home() {
  redirect("/dashboard");
}
