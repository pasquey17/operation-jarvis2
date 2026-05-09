import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AppShell } from "../ui/AppShell";
import { OnboardingPage } from "../views/OnboardingPage";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell active="onboarding" minimalNav>
      <OnboardingPage />
    </AppShell>
  </React.StrictMode>
);

