import * as RadixTooltip from '@radix-ui/react-tooltip';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

const SharedProviderContext = createContext(false);

/**
 * Put one at the app root so tooltips share their open delay. A Tooltip
 * without one wraps itself in its own provider.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <SharedProviderContext.Provider value>
      <RadixTooltip.Provider delayDuration={400}>{children}</RadixTooltip.Provider>
    </SharedProviderContext.Provider>
  );
}

export interface TooltipProps {
  /**
   * Supplementary text only. It opens on hover and on keyboard focus, but a
   * touch screen has no hover, so it must never hold essential information:
   * anything the user needs must also be visible without it.
   */
  content: ReactNode;
  children: ReactElement;
}

export function Tooltip({ content, children }: TooltipProps) {
  const shared = useContext(SharedProviderContext);
  const tooltip = (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} sideOffset={6}>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
  return shared ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}
