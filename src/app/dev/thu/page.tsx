import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { devMailbox } from "@/modules/mail/fake-sink";

// Hộp thư giả cho môi trường dev (chưa có email thật — cổng G7). Production: proxy và trang đều trả 404.
async function Messages() {
  await connection();
  if (process.env.NODE_ENV !== "development") notFound();
  const messages = devMailbox.messages().reverse();
  if (messages.length === 0) return <p>Chưa có thư.</p>;
  return (
    <ul>
      {messages.map((m, i) => (
        <li key={i} style={{ marginBottom: 12 }}>
          <strong>{m.to}</strong> ({m.kind})<br />
          {m.kind === "admin_link" ? <a href={m.body}>{m.body}</a> : m.body}
        </li>
      ))}
    </ul>
  );
}

export default function DevMailboxPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Hộp thư dev</h1>
      <Suspense>
        <Messages />
      </Suspense>
    </main>
  );
}
