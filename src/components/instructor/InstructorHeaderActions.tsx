'use client';

import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Settings, LogOut } from 'lucide-react';
import Link from 'next/link';
import StudyResetButton from '@/components/study/StudyResetButton';

interface InstructorHeaderActionsProps {
    email: string;
    /** Present only for study participants → renders the workspace reset control. */
    studyReset?: {
        scope: 'dataset' | 'all';
        datasetKey?: string;
        datasetLabel?: string;
    };
}

export default function InstructorHeaderActions({ email, studyReset }: InstructorHeaderActionsProps) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-[hsl(var(--muted-foreground))] mr-2 hidden sm:inline-block">
                {email}
            </span>

            {studyReset && (
                <StudyResetButton
                    scope={studyReset.scope}
                    datasetKey={studyReset.datasetKey}
                    datasetLabel={studyReset.datasetLabel}
                />
            )}

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

            <Tooltip id="header-tooltip" place="bottom" className="z-50 !bg-[hsl(var(--popover))] !text-[hsl(var(--popover-foreground))] !border !border-[hsl(var(--border))] !rounded-md shadow-md text-xs px-2 py-1" />
        </div>
    );
}
