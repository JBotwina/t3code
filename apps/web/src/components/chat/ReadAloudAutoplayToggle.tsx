import { PlayIcon } from "lucide-react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Switches autoplay for read-aloud: every new reply is spoken as it lands.
 *
 * Lives in the composer's trailing controls, beside the context ring, because
 * the moment the user decides they would rather listen than read is the moment
 * just after they press send — and that is where their cursor already is. No
 * label: on is a filled play glyph, off is an outline.
 */
export function ReadAloudAutoplayToggle() {
  const autoplay = usePrimarySettings((settings) => settings.readAloud?.autoplay ?? false);
  const updateSettings = useUpdatePrimarySettings();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="switch"
            aria-checked={autoplay}
            aria-label="Read new replies aloud"
            // The composer owns focus; taking it to flip a switch would close
            // the caret out of the prompt mid-thought.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => updateSettings({ readAloud: { autoplay: !autoplay } })}
            className={cn(
              "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              autoplay
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent data-[pressed]:bg-accent",
            )}
          />
        }
      >
        <PlayIcon className={cn("size-3.5", autoplay && "fill-current")} />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {autoplay ? "Stop reading new replies aloud" : "Read new replies aloud"}
      </TooltipPopup>
    </Tooltip>
  );
}
