'use client';

import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Settings, LogOut } from 'lucide-react';
import Link from 'next/link';
interface InstructorHeaderActionsProps {
    email: string;
    /**
     * Whether this header may act on the ACCOUNT — settings and log out.
     *
     * False for a study participant. Their account is study plumbing they were
     * never told they have, and Settings is not merely off-task: it carries
     * Delete account, which removes the `instructors` row that IS the
     * participant, orphaning their two clones and the block they are in the
     * middle of. Two clicks from a header they stare at for 25 minutes.
     *
     * Log out goes with it, both because it sits next to that gear as a red
     * icon and because no other study screen has either control — /study/session,
     * the block test and the survey carry no account chrome at all. The studio
     * only ever had them by borrowing the instructor product's header.
     *
     * The email stays: on a shared screen it is how a facilitator confirms which
     * participant is signed in.
     */
    showAccountControls?: boolean;
}

export default function InstructorHeaderActions({
    email,
    showAccountControls = true,
}: InstructorHeaderActionsProps) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-[hsl(var(--muted-foreground))] mr-2 hidden sm:inline-block">
                {email}
            </span>

            {showAccountControls && (
              <>
            {/* Settings */}
            <Link href="/instructor/settings" passHref>
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    data-tooltip-id="header-tooltip"
                    data-tooltip-content="Settings"
                >
                    <Settings className="w-5 h-5" />
                </Button>
            </Link>

            {/* Logout */}
            <form action="/api/auth/logout" method="POST" className="inline-flex">
                <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]/90 hover:bg-[hsl(var(--destructive))]/10"
                    data-tooltip-id="header-tooltip"
                    data-tooltip-content="Log out"
                >
                    <LogOut className="w-5 h-5" />
                </Button>
            </form>
              </>
            )}

            <Tooltip id="header-tooltip" place="bottom" className="z-50 !bg-[hsl(var(--popover))] !text-[hsl(var(--popover-foreground))] !border !border-[hsl(var(--border))] !rounded-md shadow-md text-xs px-2 py-1" />
        </div>
    );
}
