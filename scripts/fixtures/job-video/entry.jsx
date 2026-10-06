import { createRoot } from 'react-dom/client';
import { JobCard } from '../../../src/components/JobCard';
const root = createRoot(document.getElementById('root'));
window.qaRender = jobs => root.render(<>{jobs.map(job => <JobCard key={job.id} job={job} variant={Object.hasOwn(job, "variant") ? job.variant : "list"}
  videoPlacement={job.videoPlacement} priority={job.priority} views={job.views} saved={false} onToggleSave={() => { window.qaLikes++; }} onOpen={() => { window.qaOpened++; }} />)}</>);
window.qaRender(window.qaJobs);
