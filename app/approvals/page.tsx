import { Suspense } from "react";
import { ApprovalsList } from "@/components/approvals/approvals-list";

export default function ApprovalsPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Pending Approvals</h1>
      <Suspense fallback={<div>Loading approvals...</div>}>
        <ApprovalsList />
      </Suspense>
    </div>
  );
}
