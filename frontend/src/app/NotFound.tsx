import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section>
      <h1>We couldn't find that</h1>
      <p>
        <Link to="/">Back to the library</Link>
      </p>
    </section>
  );
}
