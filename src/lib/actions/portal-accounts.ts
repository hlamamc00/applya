"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { str } from "@/lib/utils";
import type { FormState } from "./auth";

function cleanHost(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

export async function savePortalLogin(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/settings");
  const host = cleanHost(str(formData.get("host")) === "other" ? str(formData.get("customHost")) : str(formData.get("host")));
  const username = str(formData.get("username"));
  const password = String(formData.get("password") ?? "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { error: "Enter the site's address, like reed.co.uk." };
  if (!username) return { error: "Enter the email or username you sign in with." };
  if (!password) return { error: "Enter the password for that site." };
  await db.portalAccount.upsert({
    where: { userId_host: { userId: user.id, host } },
    create: { userId: user.id, host, username, passwordEnc: encrypt(password) },
    update: { username, passwordEnc: encrypt(password), lastResult: "" },
  });
  revalidatePath("/app/settings");
  return { ok: `Saved. The browser will sign in to ${host} as ${username} when that site asks for an account.` };
}

export async function removePortalLogin(formData: FormData) {
  const user = await requireUser("/app/settings");
  const id = str(formData.get("id"));
  await db.portalAccount.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/settings");
}
