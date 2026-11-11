import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
export default async function LoginPage(){if(await currentUser())redirect("/dashboard");return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark">A</span>AgentTrust Gateway</div><h1>Merchant sign in</h1><p className="subtitle">Access your agent trust and payment operations.</p><AuthForm mode="login"/><div className="auth-link">New to AgentTrust? <Link href="/register">Create an account</Link></div></section></main>}
