# Setup
Follow these instructions to set up energy-bot on Google Firebase. They assume this is the first time setting up an
application in google firebase. Steps could be slightly different if you have an app already in firebase.

1. Create Firebase Project for Deployment
    * Open Web Browser of choice and navigate to https://console.firebase.google.com
        * if you are not logged into your google account you will be asked to sign in by entering your google account
        information
    * Click *Create a project* button
      ![create_project.png](doc-imgs/create-project.png)
    * Type *energy-bot* in Project name field
    * Check *I accept the firebase terms* box
      ![naming_project.png](doc-imgs/naming-project.png)
    * Click *Continue* button
    * Click *Continue* button on Google Analytics page
      ![google-analytics.png](doc-imgs/google-analytics.png)
    * Click *Create Project* button on Configure Google Analytics page
      ![configure-google-analytics.png](doc-imgs/configure-google-analytics.png)
    * Wait for project to finish creating once done Click *Continue* button
      ![waiting-for-project-creation.png](doc-imgs/waiting-for-project-creation.png)
2. Upgrade Firebase Project to Blaze
    * Click *Upgrade* button on bottom right corner of screen
    ![blaze-upgrade-button.png](doc-imgs/blaze-upgrade-button.png)
    * Click *Select Plan* button to upgrade firebase project to Blaze (This is required to run webhooks in firebase)
    ![select-plan-button.png](doc-imgs/select-plan-button.png)
    * Click *Continue* button
    ![charge-warning.png](doc-imgs/charge-warning.png)
    * Click *Continue* button
    ![create-new-billing-account.png](doc-imgs/create-new-billing-account.png)
3. Install Firebase CLI (This is a command line tool that is used to interact with google firebase platform and preform
   energy bot deployment)
    * Download Firebase cli
        * Windows https://firebase.tools/bin/win/instant/latest
        * MacOS
4. Login to firebase CLI
    * Open terminal window
        * Windows
        * MacOS
5. Generate ByBit API keys
    * Login to bybit account
      ** Test URL
6. Deploy Bot to Firebase by running the following commands
   ```shell
   firebase 
```
7. Confirm your bot loads
    * In your web browser of choice 