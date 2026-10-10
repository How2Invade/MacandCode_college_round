import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidepanel } from '../../src/sidepanel/Sidepanel';

describe('Sidepanel React Component', () => {
  it('should render the header and mode buttons', () => {
    render(<Sidepanel />);
    expect(screen.getByText('Handsfree')).toBeInTheDocument();
    expect(screen.getByText(/✋ Hand Mode/i)).toBeInTheDocument();
    expect(screen.getByText(/👤 Head Mode/i)).toBeInTheDocument();
  });

  it('should render control buttons, approval mode toggles, and language options', () => {
    render(<Sidepanel />);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.getByText('Ask')).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('हिन्दी')).toBeInTheDocument();
    expect(screen.getByText('मराठी')).toBeInTheDocument();
  });

  it('should allow changing tracking mode and languages', () => {
    render(<Sidepanel />);
    const headBtn = screen.getByText(/👤 Head Mode/i);
    fireEvent.click(headBtn);
    expect(headBtn).toHaveClass('bg-indigo-600');

    const hindiBtn = screen.getByText('हिन्दी');
    fireEvent.click(hindiBtn);
    expect(screen.getByText(/HI Mode/i)).toBeInTheDocument();
  });
});
