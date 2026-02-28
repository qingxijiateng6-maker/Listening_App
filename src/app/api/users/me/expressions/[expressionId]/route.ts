import { NextRequest, NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/server/requestUser";
import { isUserExpressionStatus, upsertUserExpression } from "@/lib/server/userExpressions";

export const runtime = "nodejs";

type UpdateUserExpressionBody = {
  status?: unknown;
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ expressionId: string }> },
) {
  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { expressionId } = await params;
  if (!expressionId) {
    return NextResponse.json({ error: "expressionId is required" }, { status: 400 });
  }

  const body = (await request.json()) as UpdateUserExpressionBody;
  if (!isUserExpressionStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const expression = await upsertUserExpression(user.uid, expressionId, body.status);
  return NextResponse.json(expression);
}
