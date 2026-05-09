import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AppShell } from "../ui/AppShell";
import { LandingPage } from "../views/LandingPage";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell active="app">
      <LandingPage />
    </AppShell>
  </React.StrictMode>
);

