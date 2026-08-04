
import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  onClick?: () => void;
  fill?: boolean;
}

export const Icon: React.FC<IconProps> = ({ name, className = "", onClick, fill = false }) => (
  <span 
    className={`material-symbols-outlined select-none inline-block align-middle ${className}`}
    style={{ fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 300, 'opsz' 24` }}
    onClick={onClick}
  >
    {name}
  </span>
);
