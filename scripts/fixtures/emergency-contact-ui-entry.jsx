import React from 'react';
import {createRoot} from 'react-dom/client';
import ContractEmergencyContact from '../../src/components/ContractEmergencyContact';
const root = createRoot(document.getElementById('root'));
window.qaRender = (props, key = 'contact') => root.render(<ContractEmergencyContact key={key} {...props} />);
window.qaRender(window.qaProps);
