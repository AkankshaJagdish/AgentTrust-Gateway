import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
export default async function RegisterPage(){if(await currentUser())redirect("/dashboard");return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark">A</span>AgentTrust Gateway</div><h1>Create merchant account</h1><p className="subtitle">Set up your merchant trust workspace.</p><AuthForm mode="register"/><div className="auth-link">Already registered? <Link href="/login">Sign in</Link></div></section></main>}
