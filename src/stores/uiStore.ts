import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface UIState {
  // Chat Panel UI
  isChatOpen: boolean;
  chatWidth: number;
  isResizing: boolean;

  // Other UI states
  showInstructions: boolean;
  saveStatus: 'ready' | 'saving' | 'saved';

  // Actions
  toggleChat: () => void;
  setChatOpen: (isOpen: boolean) => void;
  setChatWidth: (width: number) => void;
  setResizing: (isResizing: boolean) => void;
  toggleInstructions: () => void;
  setSaveStatus: (status: 'ready' | 'saving' | 'saved') => void;

  // Resize logic
  startResize: () => void;
  stopResize: () => void;
  handleResize: (clientX: number) => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    (set, get) => ({
      // Initial state
      isChatOpen: true,
      chatWidth: 480, // Default 480px
      isResizing: false,
      showInstructions: false,
      saveStatus: 'ready',

      // Simple actions
      toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen })),
      setChatOpen: (isOpen) => set({ isChatOpen: isOpen }),
      setChatWidth: (width) => set({ chatWidth: Math.min(Math.max(width, 300), 800) }),
      setResizing: (isResizing) => set({ isResizing }),
      toggleInstructions: () => set((state) => ({ showInstructions: !state.showInstructions })),
      setSaveStatus: (status) => set({ saveStatus: status }),

      // Resize logic
      startResize: () => {
        set({ isResizing: true });
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      },

      stopResize: () => {
        set({ isResizing: false });
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      },

      handleResize: (clientX: number) => {
        if (!get().isResizing) return;
        const newWidth = window.innerWidth - clientX;
        get().setChatWidth(newWidth);
      },
    }),
    { name: 'UIStore' }
  )
);

// Custom hook for resize functionality
export function useResizeHandler() {
  const { isResizing, handleResize, stopResize } = useUIStore();

  // Set up event listeners when resizing
  if (typeof window !== 'undefined') {
    const handleMouseMove = (e: MouseEvent) => handleResize(e.clientX);
    const handleMouseUp = () => stopResize();

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }

  return null;
}
