import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AppShell } from "../ui/AppShell";
import { OnboardingPage } from "../views/OnboardingPage";
import { PathPickerPage } from "../views/PathPickerPage";
import { requireAuthSession } from "../lib/jarvisAuth";

function OnboardingRoot() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("step") === "profile") {
    return <OnboardingPage />;
  }
  return <PathPickerPage />;
}

void requireAuthSession().then((session) => {
  if (!session) return;
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppShell active="onboarding" minimalNav>
        <OnboardingRoot />
      </AppShell>
    </React.StrictMode>
  );
});
