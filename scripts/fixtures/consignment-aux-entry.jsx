import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConsignmentRoom} from '../../src/features/consignment/ConsignmentRoom';
import {ConsignFieldsPane} from '../../src/features/consignment/components/ConsignFieldsPane';
import {ConsignLendPane} from '../../src/features/consignment/components/ConsignLendPane';
import {fixture} from './consignment-aux-client';
import {uid} from './consignment-deal-client.mjs';
function QA(){const [fields,setFields]=useState(fixture.state.fields),[profile,setProfile]=useState(fixture.state.profile);return window.qaMode==='fields'?<ConsignFieldsPane ownerId={uid} fields={fields} onReload={()=>setFields([...fixture.state.fields])}/>:window.qaMode==='lend'?<ConsignLendPane ownerId={uid} consignor={profile} onSaved={setProfile}/>:<ConsignmentRoom/>;}
createRoot(document.getElementById('root')).render(<QA/>);
