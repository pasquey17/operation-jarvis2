import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AppShell } from "../ui/AppShell";
import { PricingPage } from "../views/PricingPage";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell active="pricing">
      <PricingPage />
    </AppShell>
  </React.StrictMode>
);

