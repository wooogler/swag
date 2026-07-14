'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function StudyAccessForm() {
  const router = useRouter();
  const [participantNumber, setParticipantNumber] = useState('');
  const [passcode, setPasscode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/study/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantNumber, passcode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sign-in failed');
      // Full navigation so the server component re-reads the new session cookie.
      window.location.assign(data.redirect as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md border-0 sm:border shadow-none sm:shadow-sm">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-3xl font-bold tracking-tight">SCORE</CardTitle>
          <CardDescription>
            Enter your participant number and the study passcode. Your dataset
            workspaces are prepared automatically the first time you sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="participant-number"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Participant number
              </label>
              <Input
                id="participant-number"
                name="participantNumber"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                required
                autoFocus
                value={participantNumber}
                onChange={(e) => setParticipantNumber(e.target.value)}
                placeholder="e.g. P01"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="participant-passcode"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Passcode
              </label>
              <Input
                id="participant-passcode"
                name="passcode"
                type="password"
                autoComplete="off"
                required
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 rounded-md text-sm bg-destructive/10 text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Opening your workspace…' : 'Enter'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center border-t border-[hsl(var(--border))] pt-6">
          <p className="text-xs text-[hsl(var(--muted-foreground))] text-center">
            Trouble signing in? Ask the study facilitator for your number and passcode.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
