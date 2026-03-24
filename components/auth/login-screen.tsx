"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { OpenclawHeroGraphic } from "@/components/auth/openclaw-hero-graphic";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDataAdapter } from "@/lib/db";
import { toast } from "sonner";

export function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement | null>(null);
  const adapter = useMemo(() => getDataAdapter(), []);

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      toast.error("Email and password are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await adapter.signIn(email.trim(), password);
      toast.success("Signed in");
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      const heroElement = heroRef.current;

      if (!heroElement) {
        return;
      }

      const rect = heroElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const normalizedX = (event.clientX - centerX) / (rect.width / 2);
      const normalizedY = (event.clientY - centerY) / (rect.height / 2);
      const maxOffset = 2.1;
      const nextX = clamp(normalizedX * maxOffset, -maxOffset, maxOffset);
      const nextY = clamp(normalizedY * maxOffset, -maxOffset, maxOffset);

      setPupilOffset({ x: nextX, y: nextY });
    };

    const handleWindowPointerLeave = () => {
      setPupilOffset({ x: 0, y: 0 });
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerleave", handleWindowPointerLeave);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerleave", handleWindowPointerLeave);
    };
  }, []);

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen w-full items-stretch">
        <Card className="h-screen w-full gap-0 overflow-hidden rounded-none border-0 bg-card py-0 shadow-none">
          <div className="grid h-full min-h-screen md:grid-cols-[0.86fr_1.14fr] lg:grid-cols-[0.82fr_1.18fr]">
            <section className="hidden p-5 md:flex">
              <div
                ref={heroRef}
                className="relative w-full overflow-hidden rounded-[1.75rem]"
              >
                <OpenclawHeroGraphic
                  className="absolute inset-0 z-10 animate-[openclaw-hero-float_6.2s_ease-in-out_infinite]"
                  pupilOffset={pupilOffset}
                />
                <div className="pointer-events-none absolute left-[30%] top-[28%] z-20 size-2 rounded-full bg-white/75 animate-[openclaw-particle-pulse_2s_ease-in-out_infinite]" />
                <div className="pointer-events-none absolute left-[66%] top-[48%] z-20 size-1.5 rounded-full bg-white/60 animate-[openclaw-particle-pulse_2.4s_ease-in-out_infinite] [animation-delay:700ms]" />

                <div className="absolute left-7 top-7 z-40 flex items-center gap-2.5 text-white">
                  <span className="inline-flex size-8 items-center justify-center rounded-md bg-white/20 backdrop-blur-sm">
                    <span className="size-3 rounded-[4px] bg-white" />
                  </span>
                  <span className="text-sm font-semibold tracking-wide">openclaw</span>
                </div>

                <div className="absolute bottom-7 left-7 right-7 z-40 text-white">
                  <h1 className="max-w-xs text-[2rem] font-semibold leading-tight tracking-tight">
                    Run your agents.
                    <br />
                    Own every outcome.
                  </h1>
                  <p className="mt-3 max-w-sm text-sm text-white/80">
                    Monitor tasks, logs, and execution health from one focused workspace.
                  </p>
                </div>
              </div>
            </section>

            <section className="flex items-center justify-center p-5 sm:p-6 md:p-7 lg:p-8">
              <div className="w-full max-w-md">
                <div className="mb-8 space-y-1.5">
                  <h2 className="text-3xl font-semibold tracking-tight text-foreground">Sign in</h2>
                  <p className="text-sm text-muted-foreground">
                    Welcome back! Enter your details below.
                  </p>
                </div>

                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Your email address"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="keep-logged-in"
                      checked={keepLoggedIn}
                      onCheckedChange={(checked) => setKeepLoggedIn(checked === true)}
                    />
                    <Label
                      htmlFor="keep-logged-in"
                      className="text-sm font-normal text-muted-foreground"
                    >
                      Keep me logged in
                    </Label>
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-10 w-full rounded-md bg-gradient-to-b from-zinc-900 to-black text-white shadow-[0_8px_20px_-12px_black] hover:from-zinc-800 hover:to-zinc-900 dark:from-zinc-100 dark:to-zinc-200 dark:text-zinc-900 dark:hover:from-zinc-200 dark:hover:to-zinc-300"
                  >
                    {isSubmitting ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              </div>
            </section>
          </div>
        </Card>
      </div>
    </main>
  );
}
