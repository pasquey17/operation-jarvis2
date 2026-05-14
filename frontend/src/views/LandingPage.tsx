import { MotionConfig } from "framer-motion";
import { easeOs } from "../lib/motion";
import { SectionPanel } from "../components/landing/SectionPanel";
import { LandingHero } from "../components/landing/LandingHero";
import { LandingProblem } from "../components/landing/LandingProblem";
import { LandingStory } from "../components/landing/LandingStory";
import { LandingFeatures } from "../components/landing/LandingFeatures";
import { ReviewBlock } from "../components/landing/LandingMocks";
import { LandingSocialProof } from "../components/landing/LandingSocialProof";
import { LandingFaq } from "../components/landing/LandingFaq";
import { LandingFinalCta } from "../components/landing/LandingFinalCta";

export function LandingPage() {
  return (
    <MotionConfig transition={{ duration: 0.65, ease: easeOs }}>
      <div className="flex flex-col gap-10 md:gap-12">
        <SectionPanel>
          <LandingHero />
        </SectionPanel>
        <SectionPanel>
          <LandingProblem />
        </SectionPanel>
        <SectionPanel>
          <LandingStory />
        </SectionPanel>
        <SectionPanel>
          <LandingFeatures />
        </SectionPanel>
        <SectionPanel>
          <ReviewBlock />
        </SectionPanel>
        <SectionPanel>
          <LandingSocialProof />
        </SectionPanel>
        <SectionPanel id="faq">
          <LandingFaq />
        </SectionPanel>
        <SectionPanel>
          <LandingFinalCta />
        </SectionPanel>
      </div>
    </MotionConfig>
  );
}
