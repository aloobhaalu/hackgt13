export default function RepCounter({count}:{count:number}) {
  return <span className="hold-timer rep-count" aria-label={`${count} Reps`}>
    <strong>{String(count).padStart(2,'0')}</strong><span>Reps</span>
  </span>;
}
