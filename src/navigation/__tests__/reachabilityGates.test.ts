/**
 * S-REACH (2026-10-01) — static reachability and flag-gate guarantees.
 *
 * 1. Launch-critical routes keep at least one user entry outside the
 *    navigators (a regression here is a feature with no way in).
 * 2. Hidden surfaces stay hidden: live AI Guidance behind aiGuide (OFF), lab
 *    surfaces behind bloodwork (OFF), consultation view behind
 *    coachConsultationView (OFF by default, ON only in the clinic profile).
 * Read as source, like romanFlagOff.test.ts, so React Navigation is not mounted.
 */
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "..", "..");
const ROOT = path.resolve(SRC, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), "utf8");

const CLIENT_NAV = read("navigation", "ClientNavigator.tsx");
const COACH_NAV = read("navigation", "CoachNavigator.tsx");
const FLAGS = read("config", "featureFlags.ts");
const EAS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "eas.json"), "utf8"),
) as {
  build: Record<string, { env?: Record<string, string> }>;
};

function sourcesOutsideNavigation(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "navigation") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push({ file: p, text: fs.readFileSync(p, "utf8") });
      }
    }
  };
  walk(SRC);
  return out;
}

/** True when `{featureFlags.<flag> &&` opens a block that still encloses the route. */
function guardedBy(src: string, flag: string, route: string): boolean {
  const routeIdx = src.search(new RegExp(`name=["']${route}["']`));
  if (routeIdx < 0) return false;
  const before = src.slice(Math.max(0, routeIdx - 400), routeIdx);
  const guard = before.lastIndexOf(`{featureFlags.${flag} &&`);
  return guard >= 0 && !before.slice(guard).includes(")}");
}

describe("launch-critical routes have a user entry (S-REACH)", () => {
  const files = sourcesOutsideNavigation();
  const ENTRY = (route: string) =>
    new RegExp(`(navigate\\(\\s*['"]${route}['"]|screen:\\s*['"]${route}['"])`);
  it.each([
    ["Plan", "client meal plan"],
    ["ClientMacros", "client macro targets"],
    ["Progress", "client progress"],
    ["Habits", "client habits and check-in"],
    ["Timeline", "client timeline"],
    ["ExerciseLibrary", "exercise library"],
    ["ClientConsultation", "coach consultation answers"],
  ])("%s (%s) is opened from at least one screen", (route) => {
    const hits = files
      .filter((f) => ENTRY(route).test(f.text))
      .map((f) => path.relative(SRC, f.file));
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("hidden surfaces stay behind OFF flags (S-REACH)", () => {
  it("aiGuide and coachConsultationView default OFF and read literal EXPO_PUBLIC env keys", () => {
    expect(FLAGS).toMatch(
      /aiGuide:\s*readFlag\('EXPO_PUBLIC_FF_AI_GUIDE',\s*false\)/,
    );
    expect(FLAGS).toMatch(
      /coachConsultationView:\s*readFlag\('EXPO_PUBLIC_FF_COACH_CONSULTATION_VIEW',\s*false\)/,
    );
    expect(FLAGS).toMatch(
      /EXPO_PUBLIC_FF_AI_GUIDE:\s*process\.env\.EXPO_PUBLIC_FF_AI_GUIDE/,
    );
    expect(FLAGS).toMatch(
      /EXPO_PUBLIC_FF_COACH_CONSULTATION_VIEW:\s*process\.env\.EXPO_PUBLIC_FF_COACH_CONSULTATION_VIEW/,
    );
  });

  it("the AIGuide route registers only behind featureFlags.aiGuide", () => {
    expect(guardedBy(CLIENT_NAV, "aiGuide", "AIGuide")).toBe(true);
    expect(CLIENT_NAV.match(/name=["']AIGuide["']/g)).toHaveLength(1);
  });

  it("client Bloodwork and coach BloodworkReviewQueue register only behind featureFlags.bloodwork", () => {
    expect(guardedBy(CLIENT_NAV, "bloodwork", "Bloodwork")).toBe(true);
    expect(guardedBy(COACH_NAV, "bloodwork", "BloodworkReviewQueue")).toBe(
      true,
    );
  });

  it("ClientConsultation registers only behind featureFlags.coachConsultationView", () => {
    expect(
      guardedBy(COACH_NAV, "coachConsultationView", "ClientConsultation"),
    ).toBe(true);
    expect(COACH_NAV.match(/name=["']ClientConsultation["']/g)).toHaveLength(1);
  });

  it("the clinic profile turns the consultation view on; no profile turns the AI guide on", () => {
    expect(EAS.build.clinic.env?.EXPO_PUBLIC_FF_COACH_CONSULTATION_VIEW).toBe(
      "true",
    );
    expect(
      EAS.build.production.env?.EXPO_PUBLIC_FF_COACH_CONSULTATION_VIEW,
    ).toBeUndefined();
    for (const profile of Object.values(EAS.build)) {
      expect(profile.env?.EXPO_PUBLIC_FF_AI_GUIDE).toBeUndefined();
    }
  });

  it("the guard helper rejects an unguarded route", () => {
    expect(guardedBy(CLIENT_NAV, "aiGuide", "Progress")).toBe(false);
  });
});
