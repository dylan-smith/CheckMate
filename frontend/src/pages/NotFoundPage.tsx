import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'

type NotFoundPageProps = {
  message?: string
}

function NotFoundPage({
  message = "There's nothing at this address.",
}: NotFoundPageProps) {
  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
        Page not found
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {message}
      </Typography>
      <Button component={Link} to="/" variant="contained">
        Go to checklists
      </Button>
    </Paper>
  )
}

export default NotFoundPage
