import { NextRequest, NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/server/requestUser";
import { listUserExpressions } from "@/lib/server/userExpressions";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expressions = await listUserExpressions(user.uid);
  return NextResponse.json({ expressions });
}
