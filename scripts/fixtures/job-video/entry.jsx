import { createRoot } from 'react-dom/client';
import { JobCard } from '../../../src/components/JobCard';
const root = createRoot(document.getElementById('root'));
window.qaRender = jobs => root.render(<>{jobs.map(job => <JobCard key={job.id} job={job} variant="list" videoPreview={!job.noVideoPreview}
  saved={false} onToggleSave={() => { window.qaLikes++; }} onOpen={() => { window.qaOpened++; }} />)}</>);
window.qaRender(window.qaJobs);
