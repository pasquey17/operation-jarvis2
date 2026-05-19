import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AppShell } from "../ui/AppShell";
import { DashboardPage } from "../views/DashboardPage";
import { requireAuthSession } from "../lib/jarvisAuth";

void requireAuthSession().then((session) => {
  if (!session) return;
  createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell active="dashboard">
      <DashboardPage />
    </AppShell>
  </React.StrictMode>
  );
});

