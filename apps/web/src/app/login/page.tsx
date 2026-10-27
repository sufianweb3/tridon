import { redirect } from "next/navigation";
import { currentSession } from "@/lib/server-auth";
import { appConfig } from "@/lib/config";
import { setting } from "@/lib/db";
import { LoginPanel } from "@/components/login-panel";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await currentSession();
  if (session) redirect("/dashboard");
  return (
    <LoginPanel
      demoEnabled={appConfig.demoEnabled}
      demoReady={setting("demo.vault.initialized", "") === "1"}
    />
  );
}
