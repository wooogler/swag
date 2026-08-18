'use client';

/**
 * SCORE v6 — header deploy controls: the chat-version dropdown + Deploy button
 * (replaces the board's old control bar). Selecting a past version reloads the
 * page with ?chatv=N — the board then shows that deploy's intents and the
 * student traffic it served. "Current" returns to the live working board.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Rocket } from 'lucide-react';
import DeployModal from './DeployModal';
import { useSurfaceLog } from '@/lib/study/ui-log';

interface DeployControlsProps {
  assignmentId: string;
  /** Deploy versions, newest first (server-loaded). */
  versions: { versionNo: number; note: string | null }[];
  /** The version being VIEWED (?chatv=N), or null for the live board. */
  selectedVersion: number | null;
}

export default function DeployControls({ assignmentId, versions, selectedVersion }: DeployControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [latestNo, setLatestNo] = useState<number | null>(versions[0]?.versionNo ?? null);

  const refreshStatus = useCallback(() => {
    fetch(`/api/instructor/assignments/${assignmentId}/score/deploy`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d) {
          setDirty(!!d.dirty);
          setLatestNo(d.latest?.versionNo ?? null);
        }
      })
      .catch(() => {});
  }, [assignmentId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // The deploy modal is where "No rule yet — this intent adds nothing to the
  // chatbot" is on screen. Whether it was open long enough to have been read
  // before deploying is the difference between shipping an uncovered
  // configuration knowingly and by accident, and nothing else records it.
  useSurfaceLog(assignmentId, 'deploy_open', 'deploy_close', open ? 'deploy' : null, {
    liveVersionNo: latestNo,
    dirty,
  });

  return (
    <span className="flex items-center gap-2">
      <select
        value={selectedVersion ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          router.replace(v === '' ? pathname : `${pathname}?chatv=${v}`);
        }}
        className="text-xs border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
        title="View the board as of a deployed chat version"
      >
        <option value="">Current (working)</option>
        {versions.map((v) => (
          <option key={v.versionNo} value={v.versionNo}>
            chat v{v.versionNo}
            {v.note ? ` · ${v.note}` : ''}
            {v.versionNo === latestNo ? ' · live' : ''}
          </option>
        ))}
      </select>
      <button
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
        title={
          latestNo !== null
            ? `Students are on chat v${latestNo}${dirty ? ' — undeployed changes' : ''}`
            : 'Not deployed — students get the chatbot as it is today'
        }
      >
        <Rocket className="w-3.5 h-3.5" />
        Deploy
        {dirty && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" />}
      </button>

      <DeployModal
        open={open}
        onClose={() => setOpen(false)}
        assignmentId={assignmentId}
        onDeployed={() => {
          refreshStatus();
          router.refresh(); // new version shows up in the dropdown
        }}
      />
    </span>
  );
}
