import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE = "agenttrust_session";
const DAYS = 7;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createAccount(email: string, password: string, name?: string) {
  if (password.length < 10) throw new Error("Password must be at least 10 characters.");
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.create({ data: { email: email.trim().toLowerCase(), name, passwordHash } });
}
export async function signIn(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DAYS * 86400_000);
  await prisma.session.create({ data: { tokenHash: hash(token), userId: user.id, expiresAt } });
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
  return user;
}
export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hash(token) }, include: { } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  return prisma.user.findUnique({ where: { id: session.userId } });
}
export async function signOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hash(token) } });
  jar.delete(COOKIE);
}
