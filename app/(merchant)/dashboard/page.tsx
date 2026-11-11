import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard";
export default async function DashboardPage(){const user=await currentUser();if(!user)redirect("/login");return <Dashboard email={user.email}/>;}
